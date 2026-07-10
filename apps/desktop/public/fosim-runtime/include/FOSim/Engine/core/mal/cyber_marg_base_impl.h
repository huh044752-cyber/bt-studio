#pragma once
#include "FOSim/Engine/cyber_engine_type.h"
#include "core/template/safe_container.h"
/**
 * \brief 基础数据接口
 * 提供数据的克隆、获取、设置等基本操作
 */
class CyberMargBaseData
{
public:
    /**
     * \brief 克隆数据
     * 创建数据的深拷贝
     */
    virtual CyberMargBaseData *clone() = 0;
    
    /**
     * \brief 获取数据大小
     * 返回存储数据的大小
     */
    virtual size_t size() = 0;
    
    /**
     * \brief 获取数据指针
     * 返回指向实际数据的指针
     */
    virtual void *get() = 0;
    
    /**
     * \brief 设置数据
     * 设置存储的数据
     * 
     * \param data 数据指针
     */
    virtual void set(void *data) = 0;
    virtual ~CyberMargBaseData(){};
};

struct CyberMargBaseImplPrivate;

/**
 * \brief MAL中存放数据的最小单元
 * 提供数据的基本存储和访问功能
 */
class FOSIMENGINE_API CyberMargBaseImpl
{
    CyberMargBaseImpl();

public:
    /**
     * \brief 拷贝构造函数
     * 深拷贝指定的MargBase
     */
    CyberMargBaseImpl(const CyberMargBaseImpl &_marg_base_impl);
    
    /**
     * \brief 构造函数（自定义数据）
     */
    CyberMargBaseImpl(const char *_name, CyberMargBaseData *_data, CyberMARGType _type);
    
    /**
     * \brief 构造函数（布尔类型）
     */
    CyberMargBaseImpl(const char *_name, CyberBOOL _bool);
    
    /**
     * \brief 构造函数（整数类型）
     */
    CyberMargBaseImpl(const char *_name, CyberIntegerType _int);
    
    /**
     * \brief 构造函数（指针类型）
     */
    CyberMargBaseImpl(const char *_name, void *_pointer);
    
    /**
     * \brief 构造函数（字符串类型）
     */
    CyberMargBaseImpl(const char *_name, const char *_string, CyberMARGType _type);
    
    /**
     * \brief 构造函数（浮点类型）
     */
    CyberMargBaseImpl(const char *_name, double _float, CyberMARGType _type);
    
    /**
     * \brief 构造函数（实体ID类型）
     */
    CyberMargBaseImpl(const char *_name, CyberEntityIDType _id, CyberMARGType _type);
    
    /**
     * \brief 构造函数（DMGRC类型）
     */
    CyberMargBaseImpl(const char *_name, CyberDMGRC _dmgrc);
    ~CyberMargBaseImpl();

public:
    /**
     * \fn virtual CyberMargBaseImpl* CyberMargBaseImpl::Clone();
     *
     * \brief 深拷贝当前MargBase
     *
     * \author 
     * \date 2020/4/7
     *
     * \return 返回新的MargBase
     */

    /**
     * \brief 克隆MargBase
     * 深拷贝当前MargBase创建新实例
     * 
     * \return 返回新克隆的MargBase
     */
    CyberMargBaseImpl *Clone();

public:
    /**
     * \brief 获取数据指针
     * 返回MargBase中存储的数据指针
     * 
     * \return 数据指针，需要根据数据类型进行转换
     */
    void *GetValue();

    /**
     * \brief 设置数据值
     * 注意：传入的指针不会自动释放，数据会被拷贝一份。设置值之前必须先设置类型。
     * 不能用于设置TrackHandleList。当value类型为用户自定义时，需要填入size。
     * 
     * \param _value 数据指针
     * \param _size 数据大小（用户自定义类型时需要）
     */
    void SetValue(void *_value, size_t _size = 0);

    /**
     * \brief 获取名称
     * 返回MargBase中存储的名称字符串
     * 
     * \return 名称字符串指针，不会为空
     */
    const char *GetName();

    /**
     * \brief 获取数据类型
     * 返回MargBase中存储的数据类型枚举
     * 
     * \return 数据类型枚举
     */
    CyberMARGType GetType() const;
    
    /**
     * \brief 设置数据类型
     * 设置MargBase中存储的数据类型
     * 
     * \param _type 数据类型枚举
     */
    void SetType(const CyberMARGType _type);
    /**
     * \fn const size_t CyberMargBaseImpl::GetSize();
     *
     * \brief 获取MargBase中存储的数据内容的大小
     *
     * \author 
     * \date 2020/4/7
     *
     * \return 数据大小
     */

    size_t GetSize() const;

    /**
     * \brief 设置数据大小
     * 设置MargBase中存储的数据内容大小
     * 
     * \param _size 数据大小
     */
    void SetSize(const size_t &_size);

    /**
     * \brief 获取容量
     * 内部使用，获取当前分配的容量大小
     * 
     * \return 容量大小
     */
    size_t GetCapacity() const;
    
    /**
     * \brief 获取用户自定义数据
     * 返回用户自定义的数据对象
     * 
     * \return 用户自定义数据指针
     */
    CyberMargBaseData *GetUserDefineData();

    /**
     * \brief 设置左指针
     */
    void SetLPointer(CyberMargBaseImpl *_l_pointer);
    
    /**
     * \brief 设置右指针
     */
    void SetRPointer(CyberMargBaseImpl *_r_pointer);

    /**
     * \brief 获取前一个指针
     */
    CyberMargBaseImpl *GetPreviousPointer();
    
    /**
     * \brief 获取下一个指针
     */
    CyberMargBaseImpl *GetNextPointer();

private:
    void _copy_on_write();

    CyberMargBaseImpl *prev_ = nullptr;
    CyberMargBaseImpl *next_ = nullptr;
    CyberMargBaseImplPrivate *marg_base_data_;
};
